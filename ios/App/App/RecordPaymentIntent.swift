import AppIntents
import Foundation

extension Notification.Name {
    /// La acción añadió un pago a la cola mientras la app está abierta: el plugin avisa a la web para que lo lea ya.
    static let claraCapturesAdded = Notification.Name("ClaraCapturesAdded")
}

/// «Registrar pago en Clara» (Fase 2, decisión 169): la acción que una automatización de Atajos ejecuta tras un pago.
///
/// Solo anota el pago en la cola (`ClaraCaptureQueue`) y responde con una frase. No abre Clara, no calcula nada y no
/// decide nada: la web lo lee al abrirse y lo registra «Por revisar» o lo deja como propuesta. Nada sale del iPhone.
///
/// El importe llega como `IntentCurrencyAmount` (importe `Decimal` + código ISO 4217) o, si el atajo pasa texto, tal
/// cual («CA$12.50», «¥1,200»): la web lo lee con el mismo lector de monedas de toda la app y nunca adivina.
///
/// APIs comprobadas en developer.apple.com: `AppIntent` (`title`, `description: IntentDescription?`, `perform()`),
/// `IntentParameter` (`needsValueError(_:)`), `IntentCurrencyAmount` (`amount: Decimal`, `currencyCode: String`),
/// `ProvidesDialog`, `IntentResult.result(dialog:)`, `AppShortcutsProvider`, `AppShortcut(intent:phrases:shortTitle:
/// systemImageName:)` (iOS 17) y `AppShortcutPhraseToken.applicationName`. Los textos se traducen en
/// `Localizable.xcstrings` y las frases en `AppShortcuts.xcstrings`.
struct RecordPaymentIntent: AppIntent {
    static let title: LocalizedStringResource = "Record payment in Clara"
    static let description: IntentDescription? = IntentDescription("Adds a payment for Clara to review. Clara reads it the next time it opens. Nothing leaves your iPhone.")

    @Parameter(title: "Amount")
    var amount: IntentCurrencyAmount?

    @Parameter(title: "Amount as text")
    var amountText: String?

    @Parameter(title: "Merchant")
    var merchant: String?

    @Parameter(title: "Card")
    var card: String?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let rawAmount: String
        let currencyHint: String?
        if let amount {
            // `Decimal.description` siempre con punto («12.5»): lo que espera la web con `currencyHint`.
            rawAmount = amount.amount.description
            currencyHint = amount.currencyCode
        } else if let text = amountText?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            rawAmount = String(text.prefix(64))
            currencyHint = nil
        } else {
            throw $amount.needsValueError("How much was the payment?")
        }
        let line = try ClaraCaptureQueue.line(
            captureId: UUID().uuidString,
            createdAt: Date(),
            origin: "apple_pay",
            rawAmount: rawAmount,
            currencyHint: currencyHint,
            merchant: merchant.map { String($0.prefix(320)) },
            card: card.map { String($0.prefix(64)) }
        )
        do {
            try ClaraCaptureQueue.standard().append(line)
        } catch ClaraCaptureQueue.QueueError.full {
            return .result(dialog: "Clara has too many payments waiting. Open Clara to review them.")
        }
        NotificationCenter.default.post(name: .claraCapturesAdded, object: nil)
        return .result(dialog: "Saved in Clara. Review it when you open the app.")
    }
}

/// La acción aparece sola en Atajos (y se puede pedir a Siri) sin que la persona la cree.
struct ClaraShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: RecordPaymentIntent(),
            phrases: [
                "Record a payment in \(.applicationName)",
                "Add a payment to \(.applicationName)",
            ],
            shortTitle: "Record payment",
            systemImageName: "creditcard"
        )
    }
}
