const results = JSON.parse(process.env.GC_JOB_RESULTS ?? '{}');
const required = ['verify'];
const valid =
  Object.keys(results).length === required.length &&
  required.every((name) => results[name]?.result === 'success');
console.log(
  JSON.stringify(
    {
      required,
      results,
      accepted: valid,
      trust:
        'candidate workflow; requires independent governance source before remote enforcement',
    },
    null,
    2,
  ),
);
process.exitCode = valid ? 0 : 1;
