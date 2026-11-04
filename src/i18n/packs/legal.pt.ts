/** Textos de Términos y privacidad (pantalla Legal) (pt): paquete diferido, fuera del JS inicial (`src/i18n/packs.ts`). */
import type { LegalPackKey } from './legal.es'

export const legal: Record<LegalPackKey, string> = {
  'legal.terms.1.title': 'O que é a Clara',
  'legal.terms.1.text': 'A Clara é um aplicativo pessoal de finanças que funciona totalmente no seu dispositivo. Não há contas de usuário, servidor nem conexão com bancos.',
  'legal.terms.2.title': 'Não é consultoria financeira',
  'legal.terms.2.text': 'Os valores, projeções e avisos são calculados com regras fixas a partir do que você registra. São orientativos e podem estar incompletos; as decisões são suas.',
  'legal.terms.3.title': 'Seus dados e as cópias',
  'legal.terms.3.text': 'Você é responsável por guardar cópias exportadas. Limpar os dados do navegador, trocar de dispositivo ou desinstalar o app apaga o que está salvo.',
  'legal.terms.4.title': 'Sem garantias',
  'legal.terms.4.text': 'A Clara é oferecida como está, como protótipo, sem garantia de disponibilidade nem exatidão. Pode mudar ou deixar de funcionar sem aviso.',
  'legal.terms.5.title': 'Uso aceitável',
  'legal.terms.5.text': 'Use-a apenas com seus próprios dados ou dados de demonstração. Não tente extrair informações de outras pessoas nem usá-la para fins ilícitos.',
  'legal.privacy.1.title': 'Onde estão seus dados',
  'legal.privacy.1.text': 'Tudo o que você registra fica no armazenamento do navegador deste dispositivo (IndexedDB ou localStorage). Nada é enviado a um servidor da Clara porque ele não existe.',
  'legal.privacy.2.title': 'O que não coletamos',
  'legal.privacy.2.text': 'A Clara não coleta identificadores, estatísticas de uso, localização nem contatos, e não inclui rastreadores nem anúncios.',
  'legal.privacy.3.title': 'Assistente e provedores externos',
  'legal.privacy.3.text': 'O assistente de texto funciona no seu dispositivo. Só se quem compila o app configurar um provedor externo o texto digitado seria enviado a esse provedor; a tela do assistente indica isso.',
  'legal.privacy.4.title': 'Notificações e permissões',
  'legal.privacy.4.text': 'Os avisos são calculados no dispositivo e mostrados com a permissão do navegador, que você pode retirar quando quiser. O microfone só é usado se ativar o ditado.',
  'legal.privacy.5.title': 'Bloqueio e criptografia',
  'legal.privacy.5.text': 'O PIN e a biometria são uma barreira de tela: os dados não são criptografados. Quem tiver acesso ao navegador ou a uma cópia exportada pode lê-los.',
  'legal.privacy.6.title': 'Apagar seus dados',
  'legal.privacy.6.text': 'Você pode apagar tudo em Ajustes › Zona de perigo ou limpando os dados do site no navegador. As cópias locais automáticas e as exportadas são apagadas separadamente.',
}
