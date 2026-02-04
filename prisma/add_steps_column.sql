-- Execute este SQL no seu banco MySQL para adicionar a coluna "steps" na tabela DailyMetric.
-- Assim o erro "The column DailyMetric.steps does not exist" deixa de acontecer.
--
-- Como executar:
-- 1. MySQL Workbench / phpMyAdmin: cole e execute a linha abaixo.
-- 2. Linha de comando: mysql -u SEU_USUARIO -p ia-life-master < prisma/add_steps_column.sql

ALTER TABLE `DailyMetric` ADD COLUMN `steps` INT NOT NULL DEFAULT 0;
