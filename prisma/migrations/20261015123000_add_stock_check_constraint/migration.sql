-- AlterTable: Add check constraint to ensure stockCount is never negative
ALTER TABLE "MenuItem" ADD CONSTRAINT "stock_non_negative" CHECK ("stockCount" >= 0);
