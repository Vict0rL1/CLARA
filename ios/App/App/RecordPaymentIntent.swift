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
/// `Decimal.FormatStyle.Currency(code:locale:)` y `Decimal.formatted(_:)` (iOS 15),
/// `ProvidesDialog` e `IntentResult.result(dialog:)`. Los textos se traducen en `Localizable.xcstrings`; las frases
/// para Siri están en `ClaraShortcuts.swift` y `AppShortcuts.xcstrings`.
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
        /// Lo que se dice en la respuesta: el importe tal como lo verá la persona (no se usa para calcular).
        let shown: String
        if let amount {
            // `Decimal.description` siempre con punto («12.5»): lo que espera la web con `currencyHint`.
            rawAmount = amount.amount.description
            currencyHint = amount.currencyCode
            shown = amount.amount.formatted(Decimal.FormatStyle.Currency(code: amount.currencyCode, locale: .current))
        } else if let text = amountText?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            rawAmount = String(text.prefix(64))
            currencyHint = nil
            shown = rawAmount
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
        // «Clara: 12,50 $ en Starbucks, por revisar» (lo que pide el encargo); la web decide después si cuenta o no.
        if let place = merchant?.trimmingCharacters(in: .whitespacesAndNewlines), !place.isEmpty {
            return .result(dialog: "Clara: \(shown) at \(place), to review")
        }
        return .result(dialog: "Clara: \(shown), to review")
    }
}
