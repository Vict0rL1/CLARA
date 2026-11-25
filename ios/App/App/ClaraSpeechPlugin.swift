import Foundation
import AVFoundation
import Speech
import Capacitor

/// Dictado en el propio iPhone (Fase 5, decisión 187): el framework Speech convierte en texto lo que la persona dicta y
/// la web lo pone en el asistente, que propone y no guarda nada solo.
///
/// Solo reconocimiento EN EL DISPOSITIVO (`requiresOnDeviceRecognition`): el audio nunca sale del iPhone. Si el idioma
/// no tiene reconocimiento en el dispositivo, se dice y no se ofrece el dictado. El idioma lo decide la web
/// (`src/platform/nativeSpeech.ts`); aquí no se interpreta el texto.
///
/// - `availability({ locale })` → `{ available, reason? }`; `reason`: `unsupportedLocale`, `noOnDevice`, `denied`,
///   `restricted`.
/// - `start({ locale })`: pide los permisos (Speech y micrófono) y empieza; rechaza con `denied`, `noOnDevice`, `busy`
///   o `failed`.
/// - Evento `partial` → `{ text }`: lo reconocido hasta ahora. Evento `end` → `{ text }`: terminó sin que se pidiera.
/// - `stop()` → `{ text }`: lo último reconocido.
///
/// APIs comprobadas en developer.apple.com: `SFSpeechRecognizer(locale:)`, `supportsOnDeviceRecognition` (iOS 13),
/// `authorizationStatus()`, `requestAuthorization(_:)`, `SFSpeechAudioBufferRecognitionRequest`,
/// `requiresOnDeviceRecognition` (iOS 13), `shouldReportPartialResults`, `addsPunctuation` (iOS 16), `endAudio()`,
/// `recognitionTask(with:resultHandler:)`, `SFTranscription.formattedString` y
/// `AVAudioApplication.requestRecordPermission(completionHandler:)` (iOS 17). Textos de permiso:
/// `NSSpeechRecognitionUsageDescription` y `NSMicrophoneUsageDescription` (`InfoPlist.xcstrings`).
@objc(ClaraSpeechPlugin)
public class ClaraSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClaraSpeechPlugin"
    public let jsName = "ClaraSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var latest = ""
    private var pendingStop: CAPPluginCall?

    @objc func availability(_ call: CAPPluginCall) {
        guard let recognizer = recognizer(call) else {
            call.resolve(["available": false, "reason": "unsupportedLocale"])
            return
        }
        if !recognizer.supportsOnDeviceRecognition {
            call.resolve(["available": false, "reason": "noOnDevice"])
            return
        }
        switch SFSpeechRecognizer.authorizationStatus() {
        case .denied: call.resolve(["available": false, "reason": "denied"])
        case .restricted: call.resolve(["available": false, "reason": "restricted"])
        default: call.resolve(["available": true])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard task == nil else {
            call.reject("Ya se está dictando", "busy")
            return
        }
        guard let recognizer = recognizer(call), recognizer.supportsOnDeviceRecognition else {
            call.reject("Este idioma no se puede dictar en el iPhone", "noOnDevice")
            return
        }
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                DispatchQueue.main.async { call.reject("Sin permiso para el dictado", "denied") }
                return
            }
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        call.reject("Sin permiso para el micrófono", "denied")
                        return
                    }
                    do {
                        try self.begin(recognizer)
                        call.resolve()
                    } catch {
                        self.finish()
                        call.reject("No se pudo empezar a dictar", "failed")
                    }
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.task != nil else {
                call.resolve(["text": self.latest])
                return
            }
            self.pendingStop = call
            self.audioEngine.stop()
            self.audioEngine.inputNode.removeTap(onBus: 0)
            self.request?.endAudio()
            // El último resultado llega enseguida; si no llega, se entrega lo que haya.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.finish() }
        }
    }

    private func recognizer(_ call: CAPPluginCall) -> SFSpeechRecognizer? {
        guard let locale = call.getString("locale"), !locale.isEmpty else { return nil }
        return SFSpeechRecognizer(locale: Locale(identifier: locale))
    }

    private func begin(_ recognizer: SFSpeechRecognizer) throws {
        latest = ""
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        request.addsPunctuation = true
        self.request = request

        let input = audioEngine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
            request.append(buffer)
        }
        audioEngine.prepare()
        try audioEngine.start()

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let result {
                    self.latest = result.bestTranscription.formattedString
                    self.notifyListeners("partial", data: ["text": self.latest])
                    if result.isFinal { self.finish() }
                }
                if error != nil { self.finish() }
            }
        }
    }

    /// Para todo y entrega lo reconocido a quien pidió parar. Se puede llamar varias veces.
    private func finish() {
        let wasRunning = task != nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if let call = pendingStop {
            pendingStop = nil
            call.resolve(["text": latest])
        } else if wasRunning {
            // Terminó solo (silencio largo, fin del reconocimiento o un error): la web apaga el botón.
            notifyListeners("end", data: ["text": latest])
        }
    }
}
