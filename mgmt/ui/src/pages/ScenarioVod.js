import {useNavigate} from "react-router-dom";
import {Accordion, Form, Button, Table} from "react-bootstrap";
import React from "react";
import {Token, Errors, StreamURL, Clipboard} from "../utils";
import axios from "axios";
import SetupCamSecret from '../components/SetupCamSecret';
import useDvrVodStatus from "../components/DvrVodStatus";
import moment from "moment";

export default function ScenarioVod() {
  const [activeKey, setActiveKey] = React.useState();
  const [dvrStatus, vodStatus] = useDvrVodStatus();

  // We must init the activeKey, because the defaultActiveKey only apply when init for Accordion.
  // See https://stackoverflow.com/q/61324259/17679565
  React.useEffect(() => {
    if (!vodStatus || !dvrStatus) return;

    if (dvrStatus.all) {
      setActiveKey('2');
      return;
    }

    if (vodStatus.secret) {
      if (vodStatus.all) {
        setActiveKey('3');
      } else {
        setActiveKey('2');
      }
    } else {
      setActiveKey('1');
    }
  }, [dvrStatus, vodStatus]);

  return (
    <>
      { activeKey && <ScenarioVodImpl activeKey={activeKey} defaultApplyAll={vodStatus.all} enabled={!dvrStatus?.all} /> }
    </>
  );
}

function ScenarioVodImpl({activeKey, defaultApplyAll, enabled}) {
  const navigate = useNavigate();
  const [vodAll, setVodAll] = React.useState(defaultApplyAll);
  const [vodFiles, setVodFiles] = React.useState();

  React.useEffect(() => {
    const refreshVodFiles = () => {
      const token = Token.load();
      axios.post('/terraform/v1/hooks/vod/files', {
        ...token,
      }).then(res => {
        console.log(`VoD: Files ok, ${JSON.stringify(res.data.data)}`);
        setVodFiles(res.data.data.map(file => {
          if (!file.progress && file.media) {
            const u = new URL(file.media);
            const app = u.pathname.match(/.*\//)[0].replace(/^\//, '').replace(/\/$/, '');
            const stream = u.pathname.replace(/.*\//, '');
            file.preview = `/players/srs_player.html?schema=https&port=443&autostart=true&vhost=${u.hostname}&server=${u.hostname}&app=${app}&stream=${stream}`;
          }

          return {
            ...file,
            location: file.media,
            url: StreamURL.build(file.vhost, file.app, file.stream),
            update: moment(file.update),
            duration: Number(file.duration),
            size: Number(file.size / 1024.0 / 1024),
          };
        }).sort((a, b) => {
          return b.update - a.update;
        }).map((file, i) => {
          return {...file, i: i + 1};
        }));
      }).catch(e => {
        const err = e.response.data;
        if (err.code === Errors.auth) {
          alert(`Token过期，请重新登录，${err.code}: ${err.data.message}`);
          navigate('/routers-logout');
        } else {
          alert(`服务器错误，${err.code}: ${err.data.message}`);
        }
      });
    };

    refreshVodFiles();
    const timer = setInterval(() => refreshVodFiles(), 5000);
    return () => clearInterval(timer);
  }, [navigate]);

  const setupVodPattern = (e) => {
    e.preventDefault();

    if (!enabled) return;

    const token = Token.load();
    axios.post('/terraform/v1/hooks/vod/apply', {
      ...token, all: !!vodAll,
    }).then(res => {
      alert('设置VoD规则成功');
      console.log(`VoD: Apply patterns ok, all=${vodAll}`);
    }).catch(e => {
      const err = e.response.data;
      if (err.code === Errors.auth) {
        alert(`Token过期，请重新登录，${err.code}: ${err.data.message}`);
        navigate('/routers-logout');
      } else {
        alert(`服务器错误，${err.code}: ${err.data.message}`);
      }
    });
  };

  const copyToClipboard = async (e, text) => {
    e.preventDefault();
    if (!text) return;

    try {
      await Clipboard.copy(text);
      alert(`已经复制到剪切板`);
    } catch (e) {
      alert(`复制失败，请右键复制链接 ${e}`);
    }
  };

  return (
    <Accordion defaultActiveKey={activeKey}>
      <Accordion.Item eventKey="0">
        <Accordion.Header>场景介绍</Accordion.Header>
        <Accordion.Body>
          <div>
            云点播，指转换视频流到云点播，只要推送到服务器的流都可以对接云点播。
            <p></p>
          </div>
          <p>可应用的具体场景包括：</p>
          <ul>
            <li>直播转点播，将直播间内容，剪辑精彩片段后做成点播短视频</li>
          </ul>
          <p>使用说明：</p>
          <ul>
            <li>云点播无法使用开源方案搭建，依赖公有云的云点播（<a href='https://buy.cloud.tencent.com/price/vod/calculator' target='_blank' rel='noreferrer'>计费</a>），设置密钥后将自动开通<a href='https://console.cloud.tencent.com/vod' target='_blank' rel='noreferrer'>腾讯云VoD</a>云点播服务</li>
            <li>第一次使用，需要先设置云存储的访问密钥，我们会自动开通和LightHouse同区域的<a href='https://console.cloud.tencent.com/vod/upload-storage/cosregion' target='_blank' rel='noreferrer'>云点播存储区域</a>，同区域内网传输</li>
            <li>具体使用步骤，请根据下面引导操作</li>
          </ul>
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="1">
        <Accordion.Header>设置云密钥</Accordion.Header>
        <Accordion.Body>
          <SetupCamSecret />
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="2">
        <Accordion.Header>设置点播规则</Accordion.Header>
        <Accordion.Body>
          <Form>
            <Form.Group className="mb-3" controlId="formVodAllCheckbox">
              <Form.Check type="checkbox" label="录制所有流" disabled={!enabled} defaultChecked={vodAll} onClick={() => setVodAll(!vodAll)} />
            </Form.Group>
            <Button variant="primary" type="submit" disabled={!enabled} onClick={(e) => setupVodPattern(e)}>
              提交
            </Button>
            {!enabled && <Form.Text> * 若需要开启云点播，请关闭云录制</Form.Text>}
          </Form>
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="3">
        <Accordion.Header>点播任务列表</Accordion.Header>
        <Accordion.Body>
          {
            vodFiles?.length ? (
              <Table striped bordered hover>
                <thead>
                <tr>
                  <th>#</th>
                  <th>封面图</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>媒体流</th>
                  <th>时长</th>
                  <th>大小</th>
                  <th>分辨率</th>
                  <th>切片</th>
                  <th>VoD File</th>
                  <th>地址</th>
                  <th>预览</th>
                </tr>
                </thead>
                <tbody>
                {
                  vodFiles?.map(file => {
                    return <tr key={file.uuid} style={{verticalAlign: 'middle'}}>
                      <td>{file.i}</td>
                      <td><img src={file.cover} width={96} alt='cover' /></td>
                      <td title='若300秒没有流，会自动生成点播'>{file.progress ? '录制中' : '已完成'}</td>
                      <td>{`${file.update.format('YYYY-MM-DD HH:mm:ss')}`}</td>
                      <td>
                        {file.url}
                      </td>
                      <td>{`${file.duration.toFixed(1)}`}秒</td>
                      <td>{`${file.size.toFixed(1)}`}MB</td>
                      <td>{file.task && <>{file.task?.width} x {file.task?.height}</>}</td>
                      <td>{file.nn}</td>
                      <td><a href={`https://console.cloud.tencent.com/vod/media/manage?fileId=${file.file}`} target='_blank' rel='noreferrer'>{file.file?.slice(-8)}</a></td>
                      <td>
                        <a href={file.location} onClick={(e) => copyToClipboard(e, file.location)} target='_blank' rel='noreferrer'>HLS</a>
                        {file.task && <>&nbsp;<a href={file.task?.url} target='_blank' rel='noreferrer'>MP4</a></>}
                      </td>
                      <td><a href={file.preview} target='_blank' rel='noreferrer'>预览</a></td>
                    </tr>;
                  })
                }
                </tbody>
              </Table>
            ) : ''
          }
          {!vodFiles?.length ? '没有流。请开启点播并推流后，等待大约60秒左右，点播列表会自动更新' : ''}
        </Accordion.Body>
      </Accordion.Item>
    </Accordion>
  );
}

