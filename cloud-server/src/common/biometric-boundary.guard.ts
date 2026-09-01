import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';
import { containsProhibitedBiometricData } from './biometric-boundary.js';

@Injectable()
export class BiometricBoundaryGuard implements CanActivate {
  canActivate(context:ExecutionContext):boolean {
    const request = context.switchToHttp().getRequest<{ body?:unknown }>();
    if (containsProhibitedBiometricData(request.body)) {
      throw new BadRequestException({
        error:'FACE_DATA_FORBIDDEN',
        message:'云服务禁止接收人脸图片、特征或识别数据',
      });
    }
    return true;
  }
}
