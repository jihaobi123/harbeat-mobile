"""Bounded content-addressed staging for trusted, hash-bound NAS sources."""
import collections,hashlib,pathlib,re,shutil


class VerifiedCache:
    def __init__(self,root,limit):
        self.root=pathlib.Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.limit=limit;self.items=collections.OrderedDict()

    def stage(self,path,sha):
        path=pathlib.Path(path)
        if not re.fullmatch('[a-f0-9]{64}',sha):raise ValueError('invalid source hash')
        if sha in self.items:
            item=self.items.pop(sha);self.items[sha]=item;return item[0]
        info=path.stat();size=info.st_size
        if size>self.limit:raise ValueError('source exceeds temporary cache budget')
        while sum(v[1]for v in self.items.values())+size>self.limit:
            _,(old,_) = self.items.popitem(last=False);old.unlink()
        target=self.root/(sha+path.suffix);shutil.copyfile(path,target)
        h=hashlib.sha256()
        with target.open('rb')as f:
            for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
        after=path.stat()
        if h.hexdigest()!=sha or (info.st_size,info.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):
            target.unlink();raise ValueError('source changed while caching')
        self.items[sha]=(target,size);return target
