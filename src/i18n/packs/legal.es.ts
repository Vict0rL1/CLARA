/** Textos de Términos y privacidad (pantalla Legal): paquete diferido, fuera del JS inicial (`src/i18n/packs.ts`). El tipo de claves sale de aquí. */
export const legal = {
  'legal.terms.1.title': 'Qué es Clara',
  'legal.terms.1.text': 'Clara es una aplicación personal de finanzas que funciona por completo en tu dispositivo. No hay cuentas de usuario, servidor ni conexión con bancos.',
  'legal.terms.2.title': 'No es asesoría financiera',
  'legal.terms.2.text': 'Las cifras, proyecciones y avisos se calculan con reglas fijas a partir de lo que registras. Son orientativos y pueden estar incompletos; las decisiones son tuyas.',
  'legal.terms.3.title': 'Tus datos y las copias',
  'legal.terms.3.text': 'Eres responsable de conservar copias exportadas. Borrar los datos del navegador, cambiar de dispositivo o desinstalar la app elimina lo guardado.',
  'legal.terms.4.title': 'Sin garantías',
  'legal.terms.4.text': 'Clara se ofrece tal cual, como prototipo, sin garantía de disponibilidad ni de exactitud. Puede cambiar o dejar de funcionar sin aviso.',
  'legal.terms.5.title': 'Uso aceptable',
  'legal.terms.5.text': 'Úsala solo con tus propios datos o con datos de demostración. No intentes extraer información de otras personas ni usarla para fines ilícitos.',
  'legal.privacy.1.title': 'Dónde están tus datos',
  'legal.privacy.1.text': 'Todo lo que registras se guarda en el almacenamiento del navegador de este dispositivo (IndexedDB o localStorage). Nada se envía a un servidor de Clara porque no existe.',
  'legal.privacy.2.title': 'Qué no recogemos',
  'legal.privacy.2.text': 'Clara no recoge identificadores, estadísticas de uso, ubicación ni contactos, y no incluye rastreadores ni anuncios.',
  'legal.privacy.3.title': 'Asistente y proveedores externos',
  'legal.privacy.3.text': 'El asistente de texto funciona en tu dispositivo. Solo si quien compila la app configura un proveedor externo, el texto que escribas se enviaría a ese proveedor; la pantalla del asistente lo indica.',
  'legal.privacy.4.title': 'Notificaciones y permisos',
  'legal.privacy.4.text': 'Los avisos se calculan en el dispositivo y se muestran con el permiso del navegador, que puedes retirar cuando quieras. El micrófono solo se usa si activas el dictado.',
  'legal.privacy.5.title': 'Bloqueo y cifrado',
  'legal.privacy.5.text': 'El PIN y la biometría son una barrera de pantalla: los datos no se cifran. Quien tenga acceso al navegador o a una copia exportada puede leerlos.',
  'legal.privacy.6.title': 'Borrar tus datos',
  'legal.privacy.6.text': 'Puedes borrar todo desde Ajustes › Zona de peligro o eliminando los datos del sitio en el navegador. Las copias locales automáticas y las exportadas se borran por separado.',
} as const

export type LegalPackKey = keyof typeof legal
