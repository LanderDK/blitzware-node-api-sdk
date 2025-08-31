jest.mock('axios');

describe('introspectToken', () => {
  it('returns data for active token', async () => {
  jest.resetModules();
  const axios = require('axios');
  const mockPost = jest.fn().mockResolvedValue({ data: { active: true, sub: '123', name: 'Alice' } });
  (axios.create as unknown as jest.Mock).mockReturnValue({ post: mockPost });
  const { introspectToken } = require('../src/utils');
    const data = await introspectToken('token', 'access_token', 'cid', 'csecret');
    expect(data.name).toBe('Alice');
  });

  it('throws for inactive token', async () => {
  jest.resetModules();
  const axios = require('axios');
  const mockPost = jest.fn().mockResolvedValue({ data: { active: false } });
  (axios.create as unknown as jest.Mock).mockReturnValue({ post: mockPost });
  const { introspectToken } = require('../src/utils');
  await expect(introspectToken('token', 'access_token', 'cid', 'csecret')).rejects.toThrow();
  });
});
