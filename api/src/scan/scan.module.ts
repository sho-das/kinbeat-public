import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { ExtractorService } from './extract/extractor.service';
import { PictureReader } from './extract/picture-reader';
import { Hasher } from './hasher';
import { LogsController } from './logs.controller';
import { MuseClient } from './muse.client';
import { GithubClient } from './repo/github.client';
import { RepoScanService } from './repo/repo-scan.service';
import { RepoCache } from './repo/repo.cache';
import { ScanController } from './scan.controller';
import { ScanLog } from './scan.log';
import { ScanService } from './scan.service';

@Module({
  imports: [AuthModule],
  controllers: [ScanController, LogsController, CasesController],
  providers: [ScanService, ScanLog, CasesService, MuseClient, Hasher, PictureReader, ExtractorService, GithubClient, RepoCache, RepoScanService],
})
export class ScanModule {}
