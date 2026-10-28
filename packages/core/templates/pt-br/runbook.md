---
template:
  version: 1
  name: Runbook
  description: Responder a um alerta ou executar um procedimento de operação
  category: guide
  folder: runbooks
  fields:
    alert:
      prompt: Nome do alerta ou do gatilho
      default: ""
---

# {{title}}

Alerta: {{alert}}

Revisado em {{date}} por {{owner}}.

## Impacto

Quem é afetado e como, enquanto o alerta está ativo.

## Diagnóstico

1. Abra o dashboard e confira a métrica principal.
2. Veja os deploys recentes.
3. Procure erros nos logs dos últimos 15 minutos.

```bash
echo "o comando que ajuda no diagnóstico"
```

## Ações

1. A ação mais segura primeiro, e como confirmar que funcionou.
2. A próxima ação, se a primeira não resolver.

## Como escalar

- Quem chamar, e quando (por exemplo, depois de 30 minutos sem solução)

## Depois de resolver

- Registre o que aconteceu no canal do incidente
- Abra um postmortem se houve impacto para clientes
