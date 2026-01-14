interface MatrixPageProps {
  searchParams: Promise<{
    bookId?: string;
  }>;
}

export default async function MatrixPage({ searchParams }: MatrixPageProps) {
  const { bookId } = await searchParams;

  return (
    <div>
      <h1>Matrix View</h1>
      <p>Matrix view placeholder - coming soon</p>
      {bookId && <p>Book ID: {bookId}</p>}
    </div>
  );
}
