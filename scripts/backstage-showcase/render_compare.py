"""Compara o HTML que o MkDocs gera do arquivo original e do que o editor gravaria (spec 03, "Vitrine no Backstage").

Usa o mkdocs.yml de cada site, com os plugins (o techdocs-core põe as extensões do TechDocs, como o
mdx_truly_sane_lists, que muda o recuo das listas): só o que muda no Backstage conta como problema; o resto é só
formatação do arquivo (tabelas alinhadas, marcador de lista, link entre < >).

Uso: python render_compare.py <entrada.json> <saída.json>; entrada: [{key, site, original, saved}].
"""
import json
import re
import sys
import warnings

import markdown
from mkdocs.config import load_config

warnings.filterwarnings("ignore")
pairs = json.load(open(sys.argv[1], encoding="utf-8"))
configs = {}


def renderer(site):
    if site not in configs:
        try:
            config = load_config(config_file=f"{site}/mkdocs.yml")
            config = config.plugins.on_config(config)
            configs[site] = (list(config["markdown_extensions"]), dict(config["mdx_configs"]))
        except Exception as error:  # noqa: BLE001 - o relatório mostra o motivo
            configs[site] = error
    found = configs[site]
    if isinstance(found, Exception):
        raise found
    extensions, extension_configs = found
    return markdown.Markdown(extensions=extensions, extension_configs=extension_configs)


def normalized(html):
    # Ids gerados (notas, abas) e espaços entre tags não mudam o que a pessoa vê
    html = re.sub(r'\s(id|for|name|href)="(__tabbed|fn|fnref|__codelineno)[^"]*"', "", html)
    return re.sub(r">\s+<", "><", re.sub(r"\s+", " ", html)).strip()


def first_difference(a, b):
    i = next((n for n, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    return {"before": a[max(0, i - 80) : i + 160], "after": b[max(0, i - 80) : i + 160]}


out = {}
for pair in pairs:
    try:
        before = normalized(renderer(pair["site"]).convert(pair["original"]))
        after = normalized(renderer(pair["site"]).convert(pair["saved"]))
        # Lista "solta" (item com <p>) ou "junta": no Material só muda o espaço entre os itens (nos cards, nada)
        spacing = before != after and re.sub(r"</?p>", "", before) == re.sub(r"</?p>", "", after)
        out[pair["key"]] = {
            "sameHtml": before == after or spacing,
            "spacingOnly": spacing,
            **({} if before == after else first_difference(before, after)),
        }
    except Exception as error:  # noqa: BLE001
        out[pair["key"]] = {"sameHtml": None, "renderError": str(error)[:300]}
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"))
