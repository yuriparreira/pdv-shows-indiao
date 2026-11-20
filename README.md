# PDV Shows · Indião Store

App de caixa (PWA) para as vendas da Indião Store em shows. Funciona offline: depois da primeira abertura com internet, roda sem sinal e guarda os dados no próprio aparelho.

Acesso: https://pdv.indiaostore.com.br

Este repositório tem só o código do app. Catálogo, preços, custos, vendas e configurações ficam nos aparelhos e na planilha de sincronização da empresa, nunca aqui.

## InfiniteTap (v1.21)

Em ⚙ › "Cobrar cartão neste celular" › **No InfiniteTap**, os botões Débito e Crédito (parcelas) abrem o app da InfinitePay já com o valor, a forma e as parcelas. O padrão continua "Na maquininha".

- Depois da cobrança, o vendedor toca em **✓ Aprovou** (ou o PDV confirma sozinho se o app da InfinitePay devolver o resultado para o PDV). "Passei na maquininha física" registra o pagamento sem o InfiniteTap.
- O pagamento guarda o número do pedido do InfiniteTap e, quando o app devolve, o NSU, a autorização e a bandeira.
- Precisa do app InfinitePay instalado e logado no celular, e de internet na hora da cobrança. Mínimo R$ 1,00 e R$ 1,00 por parcela.
- A maquininha Smart não tem integração pública: continua digitando o valor nela, e a conferência pelo extrato segue igual.
