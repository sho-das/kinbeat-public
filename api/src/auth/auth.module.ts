import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { makeMailSender } from './mail';
import { SessionGuard } from './session.guard';
import { CLOCK, MAIL_SENDER } from './tokens';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuditService,
    { provide: CLOCK, useValue: { now: () => Date.now() } },
    {
      provide: MAIL_SENDER,
      useFactory: () => makeMailSender(),
    },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [AuthService, AuditService, MAIL_SENDER],
})
export class AuthModule {}
