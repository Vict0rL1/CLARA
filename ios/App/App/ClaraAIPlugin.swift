import Foundation
import Capacitor
#if canImport(FoundationModels) && !CLARA_NO_AI
import FoundationModels
#endif

/// La IA del propio iPhone (Fase 5, decisión 189): el modelo de Apple Intelligence que corre EN el dispositivo
/// (Foundation Models, iOS 26 o posterior, solo en iPhone compatibles). Es una ayuda opcional del asistente: convierte
/// texto desordenado o el texto de un recibo en propuestas. Nunca envía nada fuera (`SystemLanguageModel.default` es el
/// modelo del dispositivo; no se usa Private Cloud Compute ni ningún servidor), nunca guarda y no decide importes: lo
/// que devuelve se comprueba entero en la web (`src/domain/deviceAi.ts`), y si algo no cuadra manda el analizador de
/// siempre.
///
/// - `availability({ locale })` → `{ available, reason? }`; `reason`: `unsupportedOS` (iOS anterior a 26 o compilado
///   sin el framework), `deviceNotEligible`, `appleIntelligenceNotEnabled`, `modelNotReady`, `unsupportedLanguage`,
///   `unknown`.
/// - `extract({ text, locale, today, categories })` → `{ json }`: un JSON `{ "entries": [...] }` con el esquema de abajo.
/// - `receipt({ text, locale, today })` → `{ json }`: un JSON `{ "total", "fragment", "date", "merchant" }`.
///
/// Si este archivo no compila en tu Xcode, añade `CLARA_NO_AI` en Build Settings › Swift Compiler – Custom Flags ›
/// Active Compilation Conditions: la app compila sin la IA y Ajustes lo dice («no disponible en este iPhone»).
///
/// APIs comprobadas en developer.apple.com: `SystemLanguageModel.default`, `availability` (`.available`,
/// `.unavailable(_:)` con `deviceNotEligible`, `appleIntelligenceNotEnabled`, `modelNotReady`), `supportsLocale(_:)`,
/// `LanguageModelSession(instructions:)` (como en «Generating content and performing tasks with Foundation Models»),
/// `DynamicGenerationSchema(name:description:properties:)`, `DynamicGenerationSchema(arrayOf:minimumElements:
/// maximumElements:)`, `DynamicGenerationSchema(type:guides:)`, `DynamicGenerationSchema.Property(name:description:
/// schema:isOptional:)`, `GenerationSchema(root:dependencies:)`, `respond(to:schema:includeSchemaInPrompt:options:)`
/// y `GeneratedContent.jsonString` (todo iOS 26).
@objc(ClaraAIPlugin)
public class ClaraAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClaraAIPlugin"
    public let jsName = "ClaraAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extract", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "receipt", returnType: CAPPluginReturnPromise)
    ]

    @objc func availability(_ call: CAPPluginCall) {
        #if canImport(FoundationModels) && !CLARA_NO_AI
        if #available(iOS 26.0, *) {
            call.resolve(ClaraOnDeviceModel.availability(locale: call.getString("locale") ?? ""))
            return
        }
        #endif
        call.resolve(["available": false, "reason": "unsupportedOS"])
    }

    @objc func extract(_ call: CAPPluginCall) {
        run(call, receipt: false)
    }

    @objc func receipt(_ call: CAPPluginCall) {
        run(call, receipt: true)
    }

    private func run(_ call: CAPPluginCall, receipt: Bool) {
        guard let text = call.getString("text"), !text.isEmpty, text.count <= 8000 else {
            call.reject("Falta el texto", "invalidArguments")
            return
        }
        #if canImport(FoundationModels) && !CLARA_NO_AI
        if #available(iOS 26.0, *) {
            let today = call.getString("today") ?? ""
            let categories = call.getArray("categories", String.self) ?? []
            Task {
                do {
                    let json = receipt
                        ? try await ClaraOnDeviceModel.receipt(text: text, today: today)
                        : try await ClaraOnDeviceModel.entries(text: text, today: today, categories: categories)
                    call.resolve(["json": json])
                } catch {
                    call.reject("La IA del iPhone no respondió", "failed")
                }
            }
            return
        }
        #endif
        call.reject("La IA del iPhone no está disponible", "unavailable")
    }
}

#if canImport(FoundationModels) && !CLARA_NO_AI
@available(iOS 26.0, *)
enum ClaraOnDeviceModel {
    static func availability(locale: String) -> [String: Any] {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            if !locale.isEmpty && !model.supportsLocale(Locale(identifier: locale)) {
                return ["available": false, "reason": "unsupportedLanguage"]
            }
            return ["available": true]
        case .unavailable(let reason):
            switch reason {
            case .deviceNotEligible: return ["available": false, "reason": "deviceNotEligible"]
            case .appleIntelligenceNotEnabled: return ["available": false, "reason": "appleIntelligenceNotEnabled"]
            case .modelNotReady: return ["available": false, "reason": "modelNotReady"]
            @unknown default: return ["available": false, "reason": "unknown"]
            }
        }
    }

    private static func string(_ name: String, _ description: String, optional: Bool = false) -> DynamicGenerationSchema.Property {
        DynamicGenerationSchema.Property(name: name, description: description, schema: DynamicGenerationSchema(type: String.self), isOptional: optional)
    }

    /// Propuestas del asistente: cada una cita su trozo literal; los importes, con dígitos y punto, sin moneda.
    static func entries(text: String, today: String, categories: [String]) async throws -> String {
        let entry = DynamicGenerationSchema(name: "Entry", description: "One expense or income the person mentions", properties: [
            string("fragment", "The exact words of the note this movement comes from, copied literally, including the amount"),
            string("kind", "expense or income"),
            string("amount", "The amount with digits and a dot as decimal separator, without currency or thousands separators, for example 4.50; empty if there is none"),
            string("description", "Two or three words saying what it was"),
            string("merchant", "The shop or company if the note names one", optional: true),
            string("date", "The date as YYYY-MM-DD only if the note says when; today is \(today)", optional: true),
            string("category", "One of these ids if one fits: \(categories.joined(separator: ", "))", optional: true),
        ])
        let root = DynamicGenerationSchema(name: "Entries", description: "The movements in the note", properties: [
            DynamicGenerationSchema.Property(name: "entries", description: "One per movement, in the order of the note", schema: DynamicGenerationSchema(arrayOf: entry, minimumElements: 0, maximumElements: 50)),
        ])
        let schema = try GenerationSchema(root: root, dependencies: [entry])
        let session = LanguageModelSession(instructions: """
            You turn a person's quick note about their spending into a list of movements. \
            Copy each fragment literally from the note. Never invent movements, amounts or dates. \
            Do not convert currencies. If something is unclear, leave that field empty.
            """)
        let response = try await session.respond(to: text, schema: schema)
        return response.content.jsonString
    }

    /// El total de un recibo: la línea literal donde está, el importe con dígitos y punto, la fecha y el comercio.
    static func receipt(text: String, today: String) async throws -> String {
        let root = DynamicGenerationSchema(name: "Receipt", description: "The total paid on a receipt", properties: [
            string("fragment", "The exact line of the receipt that contains the total paid, copied literally"),
            string("total", "The total paid with digits and a dot as decimal separator, without currency, for example 12.50"),
            string("date", "The date of the receipt as YYYY-MM-DD; today is \(today)", optional: true),
            string("merchant", "The name of the shop", optional: true),
        ])
        let schema = try GenerationSchema(root: root, dependencies: [])
        let session = LanguageModelSession(instructions: """
            You read the text of a shop receipt and find the total that was paid. \
            Copy the line literally. Never invent an amount. Do not convert currencies.
            """)
        let response = try await session.respond(to: text, schema: schema)
        return response.content.jsonString
    }
}
#endif
