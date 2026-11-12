import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Cáscara nativa de iPhone (`ios/`, docs/IOS-NATIVE.md). La web compilada (`dist`) es la misma que se publica.
 *
 * `appId`: propuesto en el encargo y PENDIENTE DE CONFIRMAR con Victor antes de la primera compilación (decisión 154).
 * Los datos de la app y, más adelante, el App Group cuelgan de él: no se cambia una vez instalada.
 */
const config: CapacitorConfig = {
  appId: 'com.victorli.clara',
  appName: 'Clara',
  webDir: 'dist',
  ios: {
    // La web ya respeta las áreas seguras con `viewport-fit=cover` y `env(safe-area-inset-*)`.
    contentInset: 'never',
    preferredContentMode: 'mobile',
  },
}

export default config
