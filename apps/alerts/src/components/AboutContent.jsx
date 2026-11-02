export default function AboutContent() {
  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      <p>
        An independent archive of TARC bus service alerts in Louisville. History begins when this
        project starts collecting data.
      </p>
      <p>
        Transit data:{' '}
        <a className="text-blue-500 hover:underline" href="https://www.ridetarc.org/developers/">
          Transit Authority of River City (TARC)
        </a>
        .
      </p>
      <p>
        This project is unofficial and is not affiliated with or endorsed by TARC. Feed
        interruptions can delay updates.
      </p>
    </div>
  );
}
