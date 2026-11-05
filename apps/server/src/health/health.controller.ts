import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthResponseDto } from './health-response.dto.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Check process liveness' })
  @ApiOkResponse({ type: HealthResponseDto })
  public getHealth(): HealthResponseDto {
    return { status: 'ok' };
  }
}
