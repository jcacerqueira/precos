# PriceWatch PT - links diretos por loja

Versão com pesquisa por nome + links manuais por loja.

## Novidades

- Campo de links diretos por loja ao adicionar produto.
- Botão `Links` em cada produto para configurar/alterar URLs por loja.
- Se existir link manual para uma loja, a app usa esse URL diretamente em vez da pesquisa automática.
- `Ver lojas` continua a mostrar todas as lojas ativas e respetivo resultado/link.
- Útil para evitar falsos positivos como 1.5L vs 0.5L, packs/latas ou produtos sem relação.

## Variáveis Railway recomendadas

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
CHECK_CRON=0 9 * * *
ADMIN_API_KEY=trocar-por-chave-secreta
SCRAPER_USER_AGENT=PriceWatchPT/2.6 contact:jcacerqueira@gmail.com
REQUEST_TIMEOUT_MS=15000
ENABLED_STORES=continente,auchan,pingodoce,lidl
MIN_MATCH_SCORE=25
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM=PriceWatch PT <onboarding@resend.dev>
ALERT_TO=jcacerqueira@gmail.com
```

## Fluxo recomendado

1. Adicionar produto por nome.
2. Colar links diretos nas lojas onde souberes a página correta.
3. Para produtos existentes, usar o botão `Links`.
4. Clicar `Reset resultados`.
5. Clicar `Verificar preços agora`.
6. Abrir `Ver lojas`.
