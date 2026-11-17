import importlib.util
from pathlib import Path
import struct
import sys
import unittest
import zlib
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import fetch_assist_scene_flow_reference as m


def directory(name="spring/train/0001/frame_left/frame_left_0001.png",size=4,compressed=4,offset=0,extra=b"",flags=0,method=0):
    n=name.encode();return struct.pack("<4s6H3I5H2I",b"PK\x01\x02",45,20,flags,method,0,0,1,compressed,size,len(n),len(extra),0,0,0,0,offset)+n+extra


class ReferenceFetchTests(unittest.TestCase):
    def test_exact_range_required_not_status200_full_archive(self):
        headers=b"HTTP/1.1 303 See Other\r\nLocation: SECRET\r\n\r\nHTTP/2 206 \r\ncontent-range: bytes 2-4/9\r\netag: abc\r\n\r\n"
        self.assertEqual(m.response_range(headers,2,4,9,3),"abc")
        for bad in (headers.replace(b"206",b"200"),headers.replace(b"2-4/9",b"0-8/9"),headers.replace(b"/9",b"/10")):
            with self.assertRaises(ValueError):m.response_range(bad,2,4,9,3)
        with self.assertRaises(ValueError):m.response_range(headers,2,4,9,8)

    def test_zip64_entry_sizes_and_offsets(self):
        z=struct.pack("<HHQQQ",1,24,40,30,2**33)
        e=next(iter(m.central_entries(directory(size=0xffffffff,compressed=0xffffffff,offset=0xffffffff,extra=z)).values()))
        self.assertEqual((e["size"],e["compressedSize"],e["offset"]),(40,30,2**33))
        with self.assertRaises(ValueError):m.central_entries(directory(size=0xffffffff))

    def test_unsafe_names_and_duplicate_truncated_central_entries(self):
        for n in ("../x","/x","a/../b","x\\y","a\x00b","folder/"):
            with self.assertRaises(ValueError):m.safe_name(n)
        raw=directory()
        for v in (raw+raw,raw[:-1],raw[:20]):
            with self.assertRaises(ValueError):m.central_entries(v)

    def test_member_local_binding_crc_and_decompression_limit(self):
        name="file.png";data=b"abcd";raw=zlib.compress(data)[2:-4]
        entry={"name":name,"size":4,"compressedSize":len(raw),"offset":0,"flags":0,"method":8,"crc32":zlib.crc32(data)}
        header=struct.pack("<4s5H3I2H",b"PK\x03\x04",20,0,8,0,0,entry["crc32"],len(raw),4,len(name),0)
        class Fake:
            def get(self,url,limit,**kw):return header if limit==30 else name.encode()+raw
        self.assertEqual(m.member(Fake(),1,100,entry),data)
        with self.assertRaises(ValueError):m.member(Fake(),1,100,{**entry,"crc32":0})
        with self.assertRaises(ValueError):m.member(Fake(),1,100,{**entry,"size":2})

    def test_network_budget_reserves_failed_request_no_retry(self):
        r=m.Reader(5)
        with patch.object(m.subprocess,"run",return_value=m.subprocess.CompletedProcess([],28,b"",b"SECRET-SIGNED-URL")):
            with self.assertRaisesRegex(ValueError,"exit 28"):r.get("https://example.invalid",4)
            self.assertEqual(r.reserved,4)
            with self.assertRaisesRegex(ValueError,"budget"):r.get("https://example.invalid",2)
            self.assertNotIn("SECRET",str(r.calls))

    def test_fixed_metadata_selection_without_pixels(self):
        names={f"spring/train/{s}/frame_left/frame_left_{i:04}.png":{} for s in ("0001","0002") for i in (1,2,3)}
        chosen=m.selection(names,"train_frame_left.zip")
        self.assertEqual(len(chosen),4);self.assertTrue(all("0003.png" not in x for x in chosen))

    def test_deadline_prevents_network_dispatch_and_reserves_attempt(self):
        r=m.Reader(deadline=m.monotonic()-1)
        with patch.object(m.subprocess,"run") as run:
            with self.assertRaisesRegex(ValueError,"wall budget"):r.get("https://example.invalid",1)
            run.assert_not_called()

    def test_large_range_chunks_keep_stable_public_receipts_and_exact_total(self):
        count=512*1024+1;r=m.Reader(count)
        def invoke(command,**kwargs):
            interval=command[command.index("--header")+1];a,b=map(int,interval.split("=")[1].split("-"))
            body=b"x"*(b-a+1)
            headers=f"HTTP/2 206 \r\ncontent-range: bytes {a}-{b}/{count}\r\netag: SAME\r\n\r\n".encode()
            return m.subprocess.CompletedProcess([],0,body,headers)
        with patch.object(m.subprocess,"run",side_effect=invoke):
            self.assertEqual(len(r.get("https://official.invalid",count,interval=(0,count-1),total=count)),count)
        self.assertEqual(r.reserved,count);self.assertEqual(len(r.calls),2)


if __name__=="__main__":unittest.main()
