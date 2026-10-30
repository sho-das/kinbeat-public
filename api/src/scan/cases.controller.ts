import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { AuditService } from '../auth/audit.service';
import { clientIp } from '../security/client-ip';
import { AdminRecord } from '../store/types';
import { CasesService } from './cases.service';

type AdminRequest = { ip?: string; admin?: AdminRecord };

@Controller('cases')
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.cases.list();
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.cases.get(id);
  }

  @Post()
  async create(@Body() body: { scanId?: unknown; findingId?: unknown }, @Req() req: AdminRequest) {
    const { scanId, findingId } = body ?? {};
    if (typeof scanId !== 'string' || typeof findingId !== 'string' || !scanId || !findingId) {
      throw new BadRequestException('Send scanId and findingId');
    }
    const record = await this.cases.create(scanId, findingId);
    await this.audit.record('case_opened', req.admin, { caseId: record.id, type: record.type }, clientIp(req));
    return record;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { status?: unknown; note?: unknown; owner?: unknown }, @Req() req: AdminRequest) {
    const record = await this.cases.update(id, body);
    await this.audit.record(
      'case_updated',
      req.admin,
      { caseId: id, ...(typeof body?.status === 'string' ? { status: body.status } : {}), ownerChanged: typeof body?.owner === 'string', noteAdded: typeof body?.note === 'string' && body.note.trim() !== '' },
      clientIp(req),
    );
    return record;
  }
}
