import Foundation
import Capacitor

/// La cola de capturas para la web (Fase 2, decisión 169). Transporta texto; no lo interpreta.
///
/// - `read()` → `{ text }`: el contenido de `captures.jsonl` tal cual (la web lo valida línea a línea).
/// - `remove({ ids })` → `{ removed }`: quita esos pagos de la cola. La web solo lo pide DESPUÉS de haberlos guardado.
/// - `appendTest({ rawAmount, currencyHint, merchant })` → `{ captureId }`: «Probar» en Ajustes. Escribe una línea
///   marcada `test` por el mismo camino que la acción de Atajos; la web la convierte siempre en propuesta.
/// - Evento `capturesAdded`: la acción anotó un pago con la app abierta.
@objc(ClaraCapturesPlugin)
public class ClaraCapturesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClaraCapturesPlugin"
    public let jsName = "ClaraCaptures"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appendTest", returnType: CAPPluginReturnPromise)
    ]

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(forName: .claraCapturesAdded, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("capturesAdded", data: [:])
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    @objc func read(_ call: CAPPluginCall) {
        do {
            call.resolve(["text": try ClaraCaptureQueue.standard().readAll()])
        } catch {
            call.reject("No se pudo leer la cola de capturas", "unavailable")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let ids = call.getArray("ids", String.self) else {
            call.reject("Faltan los ids", "invalidArguments")
            return
        }
        do {
            let removed = try ClaraCaptureQueue.standard().remove(ids: Set(ids))
            call.resolve(["removed": removed])
        } catch {
            call.reject("No se pudo actualizar la cola de capturas", "unavailable")
        }
    }

    @objc func appendTest(_ call: CAPPluginCall) {
        guard let rawAmount = call.getString("rawAmount"), !rawAmount.isEmpty else {
            call.reject("Falta el importe", "invalidArguments")
            return
        }
        let captureId = UUID().uuidString
        do {
            let line = try ClaraCaptureQueue.line(
                captureId: captureId,
                createdAt: Date(),
                origin: "apple_pay",
                rawAmount: rawAmount,
                currencyHint: call.getString("currencyHint"),
                merchant: call.getString("merchant"),
                card: nil,
                test: true
            )
            try ClaraCaptureQueue.standard().append(line)
            call.resolve(["captureId": captureId])
        } catch ClaraCaptureQueue.QueueError.full {
            call.reject("La cola de capturas está llena", "full")
        } catch {
            call.reject("No se pudo escribir en la cola de capturas", "unavailable")
        }
    }
}
