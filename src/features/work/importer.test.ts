import assert from 'node:assert/strict'
import test from 'node:test'
import { companyFor, parseDelimited, toDrafts } from './importer.ts'
import type { Company, WorkItem } from './types.ts'

const companies = [
  { id: 'millena', name: 'Millena' },
  { id: 'gmat', name: 'GMAT' },
  { id: 'statix', name: 'Statix' },
] as Company[]
const ctx = { companies, fallback: 'statix', today: '2026-11-11', items: [{ ticket: '9512', title: 'Relatório já aberto' }] as WorkItem[] }

test('tabela colada do Excel vira rascunhos', () => {
  const rows = parseDelimited('Nº Chamado\tCliente\tDescrição\tPrazo\tPrioridade\tObs\n9501\tMilena\tBaixa não chegou\tsexta\tAlta\tligar\n9512\tGMAT\tRelatório errado\t15/11/2026\tMédia\t\n-\tStatix\tRevisar deploy\t-\tUrgente\t')
  const { drafts } = toDrafts(rows, ctx)
  assert.equal(drafts.length, 3)
  assert.deepEqual(
    drafts.map((d) => [d.ticket, d.companyId, d.priority, d.dueDate, d.on]),
    [
      ['9501', 'millena', 'alta', '2026-11-13', true],
      ['9512', 'gmat', 'normal', '2026-11-15', false],
      [null, 'statix', 'urgente', null, true],
    ],
  )
  assert.equal(drafts[0].title, 'Baixa não chegou')
  assert.match(drafts[0].notes, /ligar/)
  assert.match(drafts[1].dupe ?? '', /já está no quadro/)
})

test('csv com aspas e cabeçalho quebrado pelo leitor de imagem', () => {
  const rows = parseDelimited('Nº\tChamado\tCliente\tAssunto\n9520\tArmazzem\tConferir BTG\nStatix\tDeploy do ws')
  const { drafts } = toDrafts(rows, ctx)
  assert.deepEqual(drafts.map((d) => [d.ticket, d.title]), [['9520', 'Conferir BTG'], [null, 'Deploy do ws']])
  const csv = parseDelimited('ticket,assunto\n"77","Erro, no login"')
  assert.equal(toDrafts(csv, ctx).drafts[0].title, 'Erro, no login')
})

test('lista sem cabeçalho e empresa por semelhança', () => {
  const { drafts } = toDrafts(parseDelimited('9601\tCorrigir boleto duplicado\n9602\tAjustar relatório de taxas'), ctx)
  assert.deepEqual(drafts.map((d) => d.ticket), ['9601', '9602'])
  assert.equal(drafts[1].kind, 'melhoria')
  assert.equal(companyFor('G-MAT', companies, 'statix'), 'gmat')
  assert.equal(companyFor('Banco XYZ', companies, 'statix'), 'statix')
})
