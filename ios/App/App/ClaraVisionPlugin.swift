import Foundation
import UIKit
import Vision
import VisionKit
import Capacitor

/// Recibos leídos en el propio iPhone (Fase 5, decisión 188): Vision encuentra el texto de una foto y VisionKit ofrece
/// la cámara de documentos para escanear hasta 5 recibos seguidos. Nada sale del iPhone.
///
/// Aquí solo se lee: cada trozo de texto va a la web con su recuadro (normalizado de 0 a 1, origen abajo a la izquierda,
/// como lo da Vision) y la web los junta en líneas (`src/domain/ocrLines.ts`) y busca total, fecha y comercio
/// (`src/domain/receipt.ts`). No se interpretan importes.
///
/// - `availability()` → `{ text: true, scanner }` (`scanner`: si este iPhone tiene la cámara de documentos).
/// - `recognize({ image, languages })` → `{ observations }`: `image` es un JPEG o PNG en base64 (sin `data:`).
/// - `scan({ max, languages })` → `{ pages: [{ image, observations }], skipped, cancelled? }`: abre la cámara de
///   documentos; `image` es cada página en JPEG (base64, ≤ 1600 px) para guardarla con el movimiento; `skipped`, las
///   páginas que pasan de `max`.
///
/// APIs comprobadas en developer.apple.com: `VNRecognizeTextRequest` (iOS 13; `recognitionLevel`, `.accurate`,
/// `recognitionLanguages`, `usesLanguageCorrection`), `VNImageRequestHandler(cgImage:orientation:options:)`,
/// `perform(_:)`, `VNRecognizedTextObservation.topCandidates(_:)`, `boundingBox`, `VNDocumentCameraViewController`
/// (iOS 13; `isSupported`, `delegate`), `VNDocumentCameraScan.imageOfPage(at:)` y los tres métodos de
/// `VNDocumentCameraViewControllerDelegate`. Permiso: `NSCameraUsageDescription`.
@objc(ClaraVisionPlugin)
public class ClaraVisionPlugin: CAPPlugin, CAPBridgedPlugin, VNDocumentCameraViewControllerDelegate {
    public let identifier = "ClaraVisionPlugin"
    public let jsName = "ClaraVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise)
    ]

    private var scanCall: CAPPluginCall?
    private var scanMax = 5
    private var scanLanguages: [String] = []

    @objc func availability(_ call: CAPPluginCall) {
        call.resolve(["text": true, "scanner": VNDocumentCameraViewController.isSupported])
    }

    @objc func recognize(_ call: CAPPluginCall) {
        guard let base64 = call.getString("image"), let data = Data(base64Encoded: base64), let image = UIImage(data: data) else {
            call.reject("La imagen no se pudo abrir", "invalidImage")
            return
        }
        let languages = call.getArray("languages", String.self) ?? []
        DispatchQueue.global(qos: .userInitiated).async {
            let observations = ClaraVisionPlugin.observations(in: image, languages: languages)
            call.resolve(["observations": observations])
        }
    }

    @objc func scan(_ call: CAPPluginCall) {
        guard VNDocumentCameraViewController.isSupported else {
            call.reject("Este iPhone no tiene la cámara de documentos", "unavailable")
            return
        }
        guard scanCall == nil else {
            call.reject("Ya se está escaneando", "busy")
            return
        }
        scanCall = call
        scanMax = max(1, min(call.getInt("max") ?? 5, 5))
        scanLanguages = call.getArray("languages", String.self) ?? []
        DispatchQueue.main.async {
            let camera = VNDocumentCameraViewController()
            camera.delegate = self
            self.bridge?.viewController?.present(camera, animated: true)
        }
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let count = min(scan.pageCount, scanMax)
        let images = (0..<count).map { scan.imageOfPage(at: $0) }
        let skipped = scan.pageCount - count
        let languages = scanLanguages
        controller.dismiss(animated: true)
        DispatchQueue.global(qos: .userInitiated).async {
            let pages: [[String: Any]] = images.compactMap { image in
                guard let jpeg = ClaraVisionPlugin.jpeg(image, maxSide: 1600) else { return nil }
                return ["image": jpeg.base64EncodedString(), "observations": ClaraVisionPlugin.observations(in: image, languages: languages)]
            }
            DispatchQueue.main.async { self.finishScan(["pages": pages, "skipped": skipped]) }
        }
    }

    public func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true)
        finishScan(["pages": [], "skipped": 0, "cancelled": true])
    }

    public func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        controller.dismiss(animated: true)
        let call = scanCall
        scanCall = nil
        call?.reject("La cámara de documentos falló", "failed")
    }

    private func finishScan(_ result: [String: Any]) {
        let call = scanCall
        scanCall = nil
        call?.resolve(result)
    }

    /// Los trozos de texto de la imagen, con su recuadro tal como lo da Vision. Sin texto, una lista vacía.
    static func observations(in image: UIImage, languages: [String]) -> [[String: Any]] {
        guard let cgImage = image.cgImage else { return [] }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if !languages.isEmpty { request.recognitionLanguages = languages }
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation(image.imageOrientation), options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }
        return (request.results ?? []).compactMap { observation in
            guard let best = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return ["text": best.string, "x": box.origin.x, "y": box.origin.y, "width": box.size.width, "height": box.size.height]
        }
    }

    /// La página en JPEG, con el lado mayor de como mucho `maxSide` px (la web la reduce después para guardarla).
    static func jpeg(_ image: UIImage, maxSide: CGFloat) -> Data? {
        let longest = max(image.size.width, image.size.height)
        let scale = longest > maxSide ? maxSide / longest : 1
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: size)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return resized.jpegData(compressionQuality: 0.8)
    }

    static func orientation(_ value: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch value {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
