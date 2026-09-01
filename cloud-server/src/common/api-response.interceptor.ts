import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

type ApiEnvelope = {
  data: unknown;
  meta: { requestId:string };
};

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context:ExecutionContext, next:CallHandler):Observable<ApiEnvelope> {
    const request = context.switchToHttp().getRequest<{ id?:string }>();
    return next.handle().pipe(map(data => ({ data, meta:{ requestId:String(request.id || '') } })));
  }
}
