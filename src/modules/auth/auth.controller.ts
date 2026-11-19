import { Body, Controller, Post } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';
import { RegisterDto } from './dto/register.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    return this.users.register(body.email, body.password);
  }
}
