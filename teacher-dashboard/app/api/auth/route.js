// Auth API route
export async function POST(request) {
  const { password } = await request.json();
  const adminPassword = process.env.ADMIN_PASSWORD || 'giftforyou2026';

  if (password === adminPassword) {
    return Response.json({ success: true, message: 'Authenticated' });
  }

  return Response.json(
    { success: false, message: 'Invalid password' },
    { status: 401 }
  );
}
