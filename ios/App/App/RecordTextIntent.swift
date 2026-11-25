import AppIntents
import Foundation

/// «Registrar desde texto en Clara» (Fase 4, decisión 183): la acción que una automatización de Atajos ejecuta con el
/// texto de un aviso del banco (el disparador «Mensaje» con un SMS del banco, o en iOS 27 el de las notificaciones de
/// una app, si la persona lo configura así).
///
/// Como «Registrar pago en Clara», solo anota el aviso en la cola (`ClaraCaptureQueue`) y responde con una frase. No
/// abre Clara, no busca el importe ni el comercio y no decide nada: la web lee el texto al abrirse
/// (`src/domain/bankAlert.ts`) y, si no conoce el formato, lo deja como propuesta para revisar. El texto se recorta a lo
/// que acepta la web (2 000 unidades UTF-16) y se borra de la cola en cuanto Clara lo ha guardado. Nada sale del iPhone.
///
/// APIs comprobadas en developer.apple.com: las mismas que `RecordPaymentIntent` (`AppIntent`, `IntentParameter`
/// con `needsValueError(_:)`, `ProvidesDialog`, `IntentResult.result(dialog:)`). Textos en `Localizable.xcstrings`.
struct RecordTextIntent: AppIntent {
    static let title: LocalizedStringResource = "Record from text in Clara"
    static let description: IntentDescription? = IntentDescription("Adds the text of a bank alert (an SMS or a notification) for Clara to read. Clara shows it to review the next time it opens. Nothing leaves your iPhone.")

    @Parameter(title: "Alert text")
    var text: String?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let body = text?.trimmingCharacters(in: .whitespacesAndNewlines), !body.isEmpty else {
            throw $text.needsValueError("What does the alert say?")
        }
        let line = try ClaraCaptureQueue.line(
            captureId: UUID().uuidString,
            createdAt: Date(),
            origin: "bank_text",
            rawAmount: nil,
            currencyHint: nil,
            merchant: nil,
            card: nil,
            rawText: body
        )
        do {
            try ClaraCaptureQueue.standard().append(line)
        } catch ClaraCaptureQueue.QueueError.full {
            return .result(dialog: "Clara has too many payments waiting. Open Clara to review them.")
        }
        NotificationCenter.default.post(name: .claraCapturesAdded, object: nil)
        // La web decide después qué dice el aviso; aquí no se promete un importe.
        return .result(dialog: "Clara: alert saved to review")
    }
}
