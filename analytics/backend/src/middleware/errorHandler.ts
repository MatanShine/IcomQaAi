import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', error);
  
  if (error instanceof ZodError) {
    return res.status(400).json({ 
      error: 'Validation error',
      details: error.errors 
    });
  }
  
  if (error instanceof Error) {
    return res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
  
  res.status(500).json({ error: 'Internal server error' });
};