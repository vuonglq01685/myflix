import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminContentController } from './controllers/admin-content.controller';
import { AdminOpsController } from './controllers/admin-ops.controller';
import { AdminSubtitlesController } from './controllers/admin-subtitles.controller';
import { AdminContentService } from './services/admin-content.service';
import { AdminOpsService } from './services/admin-ops.service';
import { AdminSubtitlesService } from './services/admin-subtitles.service';

/** Dependency rule (HLD §1): admin may import catalog; catalog may not
 *  import admin. */
@Module({
  imports: [CatalogModule],
  controllers: [AdminContentController, AdminOpsController, AdminSubtitlesController],
  providers: [AdminContentService, AdminOpsService, AdminSubtitlesService],
})
export class AdminModule {}
