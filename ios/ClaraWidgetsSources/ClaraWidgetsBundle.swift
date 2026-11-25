import SwiftUI
import WidgetKit

/// Lo que ofrece la extensión «ClaraWidgets» al sistema. En la Fase 4, solo el control «Nuevo gasto»; los widgets de
/// la Fase 6 se añadirán aquí, en la MISMA extensión (con una cuenta gratuita de Apple cada extensión gasta un
/// identificador de app: como mucho 10 cada 7 días).
///
/// Sustituye al archivo `…Bundle.swift` que genera Xcode al crear la extensión (`docs/IOS-NATIVE.md`, «Fase 4»).
@main
struct ClaraWidgetsBundle: WidgetBundle {
    var body: some Widget {
        NewExpenseControl()
    }
}
