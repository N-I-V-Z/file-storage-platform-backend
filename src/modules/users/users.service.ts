import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { hashPassword } from '../auth/password.js';
import { UsersRepository } from './users.repository.js';

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async register(email: string, password: string) {
    const passwordHash = await hashPassword(password);
    try {
      return await this.users.create(email, passwordHash);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }
}
