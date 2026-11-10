// Bound libvips independently of the host CPU count visible inside a container.
require("sharp").concurrency(1);

require("sharp").cache({ memory: 16, files: 0, items: 32 });
