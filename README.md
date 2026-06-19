# PriceWatch PT Comparator

Versão com melhorias de correspondência de produtos por tamanho/embalagem.

## Principais melhorias

- Rejeita resultados com tamanho diferente quando o produto pesquisado inclui tamanho, por exemplo `1.5L` já não deve aceitar `0.5L`.
- Rejeita latas/packs quando a pesquisa não pede lata/pack.
- Usa o texto completo do card para encontrar tamanho, mas limpa o nome mostrado.
- Mantém detalhe por supermercado com link.
- Mantém logs do scraper para diagnosticar candidatos aceites/rejeitados.

## Variáveis recomendadas no Railway

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
CHECK_CRON=0 9 * * *
ADMIN_API_KEY=trocar-por-chave-secreta
SCRAPER_USER_AGENT=PriceWatchPT/2.4 contact:jcacerqueira@gmail.com
REQUEST_TIMEOUT_MS=15000
ENABLED_STORES=continente,auchan,pingodoce,lidl
MIN_MATCH_SCORE=25
RESEND_API_KEY=re_xxxxx
RESEND_FROM=PriceWatch PT <onboarding@resend.dev>
ALERT_TO=jcacerqueira@gmail.com
```

Depois de atualizar, usar: Reset resultados → Reset logs → Verificar preços agora.
