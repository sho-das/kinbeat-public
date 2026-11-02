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
import { PrHistoryService } from './repo/pr-history.service';
import { PrHistoryJobs } from './repo/pr-history.job';
import { RepoCache } from './repo/repo.cache';
import { ScanController } from './scan.controller';
import { ScanLog } from './scan.log';
import { ScanService } from './scan.service';
import { SiteScanService } from './site/site-scan.service';
import { SlackClient } from './slack/slack.client';
import { SlackController } from './slack/slack.controller';
import { SlackService } from './slack/slack.service';
import { SlackSessions } from './slack/slack.sessions';

import { ScanProgress } from './progress';
@Module({
  imports: [AuthModule],
  controllers: [ScanController, LogsController, CasesController, SlackController],
  providers: [ScanService, ScanLog, CasesService, MuseClient, Hasher, PictureReader, ExtractorService, GithubClient, RepoCache, RepoScanService, PrHistoryService, PrHistoryJobs, ScanProgress, SlackClient, SlackSessions, SlackService, SiteScanService],
})
export class ScanModule {}
