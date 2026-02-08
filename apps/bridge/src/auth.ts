import type { Request, Response, NextFunction } from 'express';

export function requireBearer(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Allow CORS preflight through without auth.
    if (req.method === 'OPTIONS') return res.sendStatus(204);

    const auth = req.header('authorization') ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m || m[1] !== expectedToken) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}
