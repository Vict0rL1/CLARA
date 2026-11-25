import AppIntents
import Foundation

/// «Nuevo gasto en Clara» (Fase 4, decisión 185): abre Clara en el formulario de un gasto. Pensada para el botón de
/// Acción, «Tocar atrás» (Accesibilidad › Tocar › Tocar atrás) y Siri, que pueden ejecutar un atajo. No registra nada:
/// solo abre el formulario, y lo que se guarde lo decide la persona en él.
///
/// `openAppWhenRun` (iOS 16) trae la app al primer plano. Apple lo marca como obsoleto desde iOS 26 en favor de
/// `supportedModes` (iOS 26), que no existe en iOS 18, el mínimo de Clara; para una acción que se ejecuta dentro de la
/// app la documentación lo sigue admitiendo («For backward compatibility, you can set this property to true for app
/// intents you run inside your app»). Con el SDK de iOS 26 o posterior Xcode avisa de que está obsoleto: es un aviso,
/// no un error.
struct NewExpenseIntent: AppIntent {
    static let title: LocalizedStringResource = "New expense in Clara"
    static let description: IntentDescription? = IntentDescription("Opens Clara on the form to add an expense. Nothing is saved until you tap Save.")
    static let openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        ClaraLaunchRequests.request(.newExpense)
        return .result()
    }
}

/// Las acciones aparecen solas en Atajos (y se pueden pedir a Siri) sin que la persona las cree. «Registrar desde
/// texto» no está aquí: necesita el texto de un aviso, así que solo tiene sentido dentro de una automatización.
///
/// APIs comprobadas en developer.apple.com: `AppShortcutsProvider`, `AppShortcut(intent:phrases:shortTitle:
/// systemImageName:)` (iOS 17) y `AppShortcutPhraseToken.applicationName`. Las frases se traducen en
/// `AppShortcuts.xcstrings` (cada una lleva el nombre de la app, como exige Apple).
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
        AppShortcut(
            intent: NewExpenseIntent(),
            phrases: [
                "New expense in \(.applicationName)",
                "Add an expense in \(.applicationName)",
            ],
            shortTitle: "New expense",
            systemImageName: "plus.circle"
        )
    }
}
