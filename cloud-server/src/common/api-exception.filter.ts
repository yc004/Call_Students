import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger=new Logger(ApiExceptionFilter.name);
  catch(exception:unknown, host:ArgumentsHost):void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = exception instanceof HttpException ? exception.getResponse() : null;
    const details = typeof response === 'object' && response && 'message' in response
      ? (response as { message?:unknown }).message
      : undefined;
    const message = status >= 500
      ? '服务器暂时无法处理请求'
      : typeof response === 'string'
        ? response
        : Array.isArray(details)
          ? String(details[0] || '请求参数不正确')
          : String(details || '请求失败');
    const code = typeof response === 'object' && response && 'error' in response
      ? String((response as { error?:unknown }).error || 'REQUEST_FAILED').toUpperCase().replace(/\s+/g, '_')
      : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';

    const context={requestId:String(request.id||''),method:request.method,url:request.url,status};
    if(status>=500)this.logger.error(JSON.stringify(context),exception instanceof Error?exception.stack:undefined);
    else if(status===401||status===403)this.logger.warn(JSON.stringify({...context,code}));

    reply.code(status).send({
      error:{ code, message, ...(Array.isArray(details) ? { details } : {}), requestId:String(request.id || '') },
    });
  }
}
