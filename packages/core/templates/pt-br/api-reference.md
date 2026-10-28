---
template:
  version: 1
  name: Referência de API
  description: O contrato de uma API, para quem integra
  category: reference
---

# {{title}}

Para que serve a API, em uma ou duas frases.

## Autenticação

Como conseguir um token e onde mandá-lo.

```bash
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/v1/items
```

## Endpoints

### Listar itens

`GET /v1/items`

| Parâmetro | Tipo   | Descrição                    |
| --------- | ------ | ---------------------------- |
| limit     | number | Quantos itens, até 100       |
| cursor    | string | Onde começa a próxima página |

Exemplo de resposta:

```json
{
  "items": [],
  "next": null
}
```

Erros: o que cada código de erro significa aqui.

## Limites

Quantas requisições por minuto, e o que acontece acima disso.

## Versões

Como as versões mudam, e por quanto tempo uma versão antiga continua valendo.
