/** Textos de Términos y privacidad (pantalla Legal) (fr): paquete diferido, fuera del JS inicial (`src/i18n/packs.ts`). */
import type { LegalPackKey } from './legal.es'

export const legal: Record<LegalPackKey, string> = {
  'legal.terms.1.title': 'Ce qu\'est Clara',
  'legal.terms.1.text': 'Clara est une application de finances personnelles qui fonctionne entièrement sur votre appareil. Il n\'y a ni compte utilisateur, ni serveur, ni connexion bancaire.',
  'legal.terms.2.title': 'Pas un conseil financier',
  'legal.terms.2.text': 'Les chiffres, projections et alertes sont calculés par des règles fixes à partir de ce que vous enregistrez. Ils sont indicatifs et peuvent être incomplets ; les décisions vous appartiennent.',
  'legal.terms.3.title': 'Vos données et sauvegardes',
  'legal.terms.3.text': 'Vous êtes responsable de la conservation de sauvegardes exportées. Effacer les données du navigateur, changer d\'appareil ou désinstaller l\'application supprime ce qui est stocké.',
  'legal.terms.4.title': 'Sans garantie',
  'legal.terms.4.text': 'Clara est fournie telle quelle, en tant que prototype, sans garantie de disponibilité ni d\'exactitude. Elle peut changer ou cesser de fonctionner sans préavis.',
  'legal.terms.5.title': 'Usage acceptable',
  'legal.terms.5.text': 'Utilisez-la uniquement avec vos propres données ou des données de démonstration. N\'essayez pas d\'extraire des informations d\'autres personnes ni de l\'utiliser à des fins illicites.',
  'legal.privacy.1.title': 'Où se trouvent vos données',
  'legal.privacy.1.text': 'Tout ce que vous enregistrez est stocké dans le navigateur de cet appareil (IndexedDB ou localStorage). Rien n\'est envoyé à un serveur Clara, car il n\'y en a pas.',
  'legal.privacy.2.title': 'Ce que nous ne collectons pas',
  'legal.privacy.2.text': 'Clara ne collecte ni identifiants, ni statistiques d\'usage, ni localisation, ni contacts, et ne contient ni traceurs ni publicités.',
  'legal.privacy.3.title': 'Assistant et fournisseurs externes',
  'legal.privacy.3.text': 'L\'assistant textuel fonctionne sur votre appareil. Ce n\'est que si la personne qui compile l\'application configure un fournisseur externe que le texte saisi lui serait envoyé ; l\'écran de l\'assistant l\'indique.',
  'legal.privacy.4.title': 'Notifications et autorisations',
  'legal.privacy.4.text': 'Les alertes sont calculées sur l\'appareil et affichées avec l\'autorisation du navigateur, que vous pouvez retirer à tout moment. Le micro n\'est utilisé que si vous activez la dictée.',
  'legal.privacy.5.title': 'Verrouillage et chiffrement',
  'legal.privacy.5.text': 'Le code et la biométrie sont une barrière d\'écran : les données ne sont pas chiffrées. Toute personne ayant accès au navigateur ou à une sauvegarde exportée peut les lire.',
  'legal.privacy.6.title': 'Supprimer vos données',
  'legal.privacy.6.text': 'Vous pouvez tout supprimer depuis Réglages › Zone de danger ou en effaçant les données du site dans le navigateur. Les sauvegardes locales automatiques et les fichiers exportés se suppriment séparément.',
}
