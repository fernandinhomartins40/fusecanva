// Catalogo de origem (pt-BR). Toda chave nova nasce aqui; o teste de chaves exige a traducao em `en`.
// Sintaxe ICU MessageFormat: {nome}, {count, plural, ...}, {kind, select, ...}.

export const ptBR = {
  'app.name': 'Fuse Studio',
  'app.tagline': 'Design visual aberto, local e seu.',

  'common.save': 'Salvar',
  'common.cancel': 'Cancelar',
  'common.close': 'Fechar',
  'common.confirm': 'Confirmar',
  'common.delete': 'Excluir',
  'common.duplicate': 'Duplicar',
  'common.rename': 'Renomear',
  'common.undo': 'Desfazer',
  'common.redo': 'Refazer',
  'common.search': 'Pesquisar',
  'common.loading': 'Carregando',
  'common.saving': 'Salvando',
  'common.retry': 'Tentar de novo',
  'common.more': 'Mais opcoes',
  'common.back': 'Voltar',
  'common.next': 'Avancar',
  'common.settings': 'Configuracoes',
  'common.optional': 'opcional',
  'common.required': 'obrigatorio',

  'ui.dialog.close': 'Fechar janela',
  'ui.toast.close': 'Fechar aviso',
  'ui.toast.region': 'Notificacoes ({hotkey})',
  'ui.select.placeholder': 'Selecione',
  'ui.theme.light': 'Tema claro',
  'ui.theme.dark': 'Tema escuro',
  'ui.theme.system': 'Seguir o sistema',

  'project.untitled': 'Projeto sem titulo',
  'project.count': '{count, plural, =0 {Nenhum projeto} one {# projeto} other {# projetos}}',
  'project.empty.title': 'Nenhum projeto ainda',
  'project.empty.description': 'Crie um design, documento, planilha ou quadro para comecar.',
  'project.lastEdited': 'Editado {when}',
  'project.ownedBy': 'De {name}',

  'editor.zoom.label': 'Zoom',
  'editor.zoom.value': '{percent, number, percent}',
  'editor.layers.title': 'Camadas',
  'editor.selection.count': '{count, plural, =0 {Nada selecionado} one {# objeto selecionado} other {# objetos selecionados}}',
  'editor.offline': 'Sem conexao. As alteracoes ficam salvas neste dispositivo.',
  'editor.synced': 'Tudo sincronizado',

  'share.title': 'Compartilhar',
  'share.role': '{role, select, owner {Proprietario} editor {Pode editar} commenter {Pode comentar} viewer {Pode ver} other {Acesso personalizado}}',
  'share.invited': '{name} foi convidado(a).',

  'export.started': 'Exportacao iniciada',
  'export.progress': 'Exportando {done} de {total} paginas',
  'export.done': 'Arquivo {format} pronto',

  'error.generic': 'Algo deu errado. Tente de novo.',
  'error.offline': 'Voce esta offline.',
  'error.fileTooLarge': 'O arquivo passa do limite de {limit}.',
} as const satisfies Record<string, string>

export type MessageKey = keyof typeof ptBR
