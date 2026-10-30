import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { PUBLIC_ROUTE } from './public';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const admin = await this.auth.adminFromCookies(request.headers.cookie);
    request.admin = admin;
    if (admin && !SAFE_METHODS.includes(request.method)) this.auth.checkOrigin(request.headers.origin);
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    if (!admin) throw new UnauthorizedException('Sign in required.');
    return true;
  }
}
