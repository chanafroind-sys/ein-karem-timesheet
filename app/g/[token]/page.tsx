import GuideApp from './GuideApp';

export default async function GuidePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <GuideApp token={token} />;
}
