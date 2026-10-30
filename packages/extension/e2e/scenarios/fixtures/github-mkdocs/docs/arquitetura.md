# Arquitetura

A API recebe os pedidos e grava no PostgreSQL. Cada mudança vira um evento na fila de clientes.
