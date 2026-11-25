import AppIntents
import SwiftUI
import WidgetKit

/// Control «Nuevo gasto» (Fase 4, decisión 185): un botón para el Centro de control, la pantalla bloqueada y el botón
/// de Acción que abre Clara en el formulario de un gasto. No registra nada.
///
/// Va en la extensión de widgets «ClaraWidgets», que se crea en Xcode (`docs/IOS-NATIVE.md`, «Fase 4»). Estas fuentes
/// NO están en el proyecto hasta entonces, así que no afectan a la compilación de la app. La acción
/// (`OpenClaraIntent`, en `ios/App/App/ClaraOpenIntent.swift`) tiene que pertenecer a la app Y a la extensión: Apple lo
/// exige para que un control abra la app.
///
/// APIs comprobadas en developer.apple.com: `ControlWidget` (SwiftUI, iOS 18), `StaticControlConfiguration(kind:
/// content:)`, `ControlWidgetButton(action:label:)` con una acción `OpenIntent` (iOS 18),
/// `ControlWidgetConfiguration.displayName(_:)` y `.description(_:)`.
struct NewExpenseControl: ControlWidget {
    static let kind = "com.victorli.clara.newExpense"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenClaraIntent(target: .newExpense)) {
                Label("New expense", systemImage: "plus.circle")
            }
        }
        .displayName("New expense")
        .description("Opens Clara on the form to add an expense.")
    }
}
