import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { MyListController } from './my-list.controller';
import { MyListService } from './my-list.service';

@Module({
  controllers: [CatalogController, MyListController],
  providers: [CatalogService, MyListService],
  exports: [CatalogService],
})
export class CatalogModule {}
