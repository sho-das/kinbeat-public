import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ScanModule } from './scan/scan.module';
import { StoreModule } from './store/store.module';

@Module({ imports: [StoreModule, AuthModule, ScanModule] })
export class AppModule {}
