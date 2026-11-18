import { useState } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import axe from 'axe-core'
import { Bold, Inbox, Italic, Settings } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTrigger,
  Divider,
  EmptyState,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Panel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Slider,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeProvider,
  ToastProvider,
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarToggleGroup,
  ToolbarToggleItem,
  Tooltip,
  TooltipProvider,
  useToast,
  VisuallyHidden,
  initialsOf,
} from '../src/index.js'

/** Roda axe-core no documento; contraste e verificado por calculo proprio (jsdom nao renderiza cor). */
async function expectNoAxeViolations(container: Element = document.body) {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  })
  const summary = result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  expect(summary).toEqual([])
}

describe('componentes estaticos', () => {
  it('renderizam a galeria completa sem violacoes axe', async () => {
    const { container } = render(
      <ThemeProvider theme="light" applyToDocument={false}>
        <main>
          <h1>Galeria</h1>
          <Button variant="primary">Salvar</Button>
          <Button loading loadingLabel="Salvando">
            Salvar
          </Button>
          <IconButton label="Configuracoes">
            <Settings size={16} aria-hidden="true" />
          </IconButton>
          <Badge tone="success">Publicado</Badge>
          <Card elevation="raised">Conteudo</Card>
          <Divider />
          <VisuallyHidden>Texto oculto</VisuallyHidden>
          <Spinner label="Carregando" />
          <Skeleton width={120} height={16} />
          <EmptyState icon={<Inbox />} title="Nada por aqui" description="Crie o primeiro projeto." headingLevel={2} />
          <Panel title="Camadas">corpo</Panel>
          <Avatar name="Ana Souza" />
          <Field label="Nome" description="Como aparece para a equipe" error="Obrigatorio" required>
            <Input />
          </Field>
          <Field label="Bio">
            <Textarea />
          </Field>
          <Field label="Formato">
            <Select options={[{ value: 'a4', label: 'A4' }, { value: 'carta', label: 'Carta' }]} placeholder="Escolha" />
          </Field>
          <Checkbox label="Lembrar" />
          <Checkbox label="Parcial" checked="indeterminate" />
          <Switch label="Grade" />
          <RadioGroup aria-label="Alinhamento" defaultValue="left">
            <Radio value="left" label="Esquerda" />
            <Radio value="right" label="Direita" />
          </RadioGroup>
          <Slider thumbLabels={['Opacidade']} defaultValue={[50]} />
          <Tabs defaultValue="a">
            <TabsList aria-label="Secoes">
              <TabsTrigger value="a">A</TabsTrigger>
              <TabsTrigger value="b">B</TabsTrigger>
            </TabsList>
            <TabsContent value="a">Painel A</TabsContent>
            <TabsContent value="b">Painel B</TabsContent>
          </Tabs>
          <Toolbar label="Formatacao">
            <ToolbarToggleGroup type="multiple" aria-label="Estilo">
              <ToolbarToggleItem value="bold" label="Negrito">
                <Bold size={16} aria-hidden="true" />
              </ToolbarToggleItem>
              <ToolbarToggleItem value="italic" label="Italico">
                <Italic size={16} aria-hidden="true" />
              </ToolbarToggleItem>
            </ToolbarToggleGroup>
            <ToolbarSeparator />
            <ToolbarButton>Limpar</ToolbarButton>
          </Toolbar>
        </main>
      </ThemeProvider>,
    )
    expect(container.querySelector('[data-fuse-theme="light"]')).not.toBeNull()
    await expectNoAxeViolations(container)
  })

  it('Button usa type=button e bloqueia enquanto carrega', () => {
    render(
      <Button loading loadingLabel="Salvando">
        Salvar
      </Button>,
    )
    const button = screen.getByRole('button')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
  })

  it('Field liga rotulo, descricao e erro ao controle', () => {
    render(
      <Field label="E-mail" description="Usado para login" error="Formato invalido">
        <Input type="email" />
      </Field>,
    )
    const input = screen.getByLabelText('E-mail')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = input.getAttribute('aria-describedby') ?? ''
    expect(described.split(' ')).toHaveLength(2)
    for (const id of described.split(' ')) expect(document.getElementById(id)).not.toBeNull()
  })

  it('Spinner anuncia status e Avatar gera iniciais', () => {
    render(
      <>
        <Spinner label="Carregando arquivos" />
        <Avatar name="maria da silva" />
      </>,
    )
    expect(screen.getByRole('status').textContent).toContain('Carregando arquivos')
    expect(initialsOf('maria da silva')).toBe('MS')
    expect(initialsOf('  ')).toBe('?')
  })

  it('ThemeProvider aplica o tema no documento e restaura ao desmontar', () => {
    const { unmount } = render(<ThemeProvider theme="dark">x</ThemeProvider>)
    expect(document.documentElement.getAttribute('data-fuse-theme')).toBe('dark')
    unmount()
    expect(document.documentElement.hasAttribute('data-fuse-theme')).toBe(false)
  })
})

describe('componentes interativos', () => {
  it('Checkbox e Switch alternam por teclado', async () => {
    const user = userEvent.setup()
    const onCheck = vi.fn()
    render(
      <>
        <Checkbox label="Aceito" onCheckedChange={onCheck} />
        <Switch label="Ajustar a grade" />
      </>,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Aceito' })
    checkbox.focus()
    await user.keyboard(' ')
    expect(onCheck).toHaveBeenCalledWith(true)
    const sw = screen.getByRole('switch', { name: 'Ajustar a grade' })
    await user.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('Tabs navega com setas', async () => {
    const user = userEvent.setup()
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="Secoes">
          <TabsTrigger value="a">Primeira</TabsTrigger>
          <TabsTrigger value="b">Segunda</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A</TabsContent>
        <TabsContent value="b">B</TabsContent>
      </Tabs>,
    )
    screen.getByRole('tab', { name: 'Primeira' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Segunda' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toBe('B')
  })

  it('RadioGroup seleciona com setas', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <RadioGroup aria-label="Tamanho" defaultValue="p" onValueChange={onChange}>
        <Radio value="p" label="Pequeno" />
        <Radio value="g" label="Grande" />
      </RadioGroup>,
    )
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Pequeno' }))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Grande' }))
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith('g')
  })

  it('Slider responde ao teclado', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Slider thumbLabels={['Zoom']} defaultValue={[10]} onValueChange={onChange} />)
    const thumb = screen.getByRole('slider', { name: 'Zoom' })
    thumb.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith([11])
  })

  it('Dialog abre, prende o foco, passa no axe e fecha com Escape', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Compartilhar</Button>
        </DialogTrigger>
        <DialogContent title="Compartilhar design" description="Convide pessoas" closeLabel="Fechar">
          <Field label="E-mail">
            <Input />
          </Field>
        </DialogContent>
      </Dialog>,
    )
    await user.click(screen.getByRole('button', { name: 'Compartilhar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Compartilhar design' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Fechar' })).toBeTruthy()
    await expectNoAxeViolations(dialog)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Menu abre por teclado e executa item', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <Menu>
        <MenuTrigger asChild>
          <Button>Arquivo</Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem shortcut="Ctrl+D" onSelect={onSelect}>
            Duplicar
          </MenuItem>
          <MenuItem tone="danger">Excluir</MenuItem>
        </MenuContent>
      </Menu>,
    )
    screen.getByRole('button', { name: 'Arquivo' }).focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2)
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('Popover e Tooltip exibem conteudo', async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider delayDuration={0}>
        <Popover>
          <PopoverTrigger asChild>
            <Button>Cor</Button>
          </PopoverTrigger>
          <PopoverContent aria-label="Seletor de cor">conteudo do popover</PopoverContent>
        </Popover>
        <Tooltip content="Desfazer" shortcut="Ctrl+Z" defaultOpen>
          <IconButton label="Desfazer">u</IconButton>
        </Tooltip>
      </TooltipProvider>,
    )
    expect((await screen.findByRole('tooltip')).textContent).toContain('Desfazer')
    await user.click(screen.getByRole('button', { name: 'Cor' }))
    expect(await screen.findByText('conteudo do popover')).toBeTruthy()
  })

  it('Toast mostra aviso pela API useToast', async () => {
    const user = userEvent.setup()
    function Demo() {
      const toast = useToast()
      const [count, setCount] = useState(0)
      return (
        <Button
          onClick={() => {
            setCount(count + 1)
            toast.show({ title: `Exportado ${count + 1}`, tone: 'success' })
          }}
        >
          Exportar
        </Button>
      )
    }
    render(
      <ToastProvider closeLabel="Fechar aviso" regionLabel="Notificacoes">
        <Demo />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Exportar' }))
    expect(await screen.findByText('Exportado 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fechar aviso' })).toBeTruthy()
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Fechar aviso' }))
    })
  })

  it('Select tem nome acessivel via Field', () => {
    render(
      <Field label="Unidade">
        <Select options={[{ value: 'px', label: 'Pixels' }]} defaultValue="px" />
      </Field>,
    )
    expect(screen.getByRole('combobox', { name: 'Unidade' })).toBeTruthy()
  })
})

describe('cobertura do catalogo', () => {
  it('exporta os 25 componentes base', async () => {
    const mod = await import('../src/index.js')
    const required = [
      'Button', 'IconButton', 'Input', 'Textarea', 'Select', 'Checkbox', 'Switch', 'Radio', 'Slider', 'Tabs',
      'Dialog', 'Popover', 'Tooltip', 'Menu', 'ToastProvider', 'Card', 'Badge', 'Avatar', 'Spinner', 'Skeleton',
      'EmptyState', 'Toolbar', 'Panel', 'Divider', 'VisuallyHidden',
    ]
    expect(required).toHaveLength(25)
    for (const name of required) expect(mod, name).toHaveProperty(name)
  })
})
