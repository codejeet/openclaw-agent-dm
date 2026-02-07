import type { Request, Response, NextFunction } from 'express';

export function requireBearer(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.header('authorization') ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m || m[1] !== expectedToken) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}
