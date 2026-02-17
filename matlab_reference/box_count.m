function [np, s, qv]=box_count( file, nb, M )

% Authors: Jeferson de Souza and Sidnei Pires Rostirolla
% Contact: jdesouza@ufpr.br
% Computers and Geosciences, 2011
% This program uses the Hou  algorithm to estimate fractal
% and/or f(alpha) spectrum from ASCII data.
% Function data_prep map the data into interval 0-2^k-1.
% Function bit_int converts the data from decimal to binary base and 
% intercalate the bits. Function bit_mask mask the intercalated data 
% and calculates the number of box which contain points or the number
% of data points contained in each box, for each iteration.
% Type [np,s,q]=box_count and use the auxiliary programs leg_transf and
% fit_frac to obtain the fractal dimension and the multifractal spectrum,
% respectively.

% file=input('File Name: ','s');
% nb=input('Precision (1 to 64): ');
% M=input('Analisys ( type 1 for monofractal or 2 for multifractal analisys); ');
v=load(file);
qv=single(-5:0.5:5);

%%%%%%%%%%%%%%%%%%%%

% tic
[v, maxi, dt, n]=data_prep(v,nb);
[v_b]=bit_int(v,dt,nb,n);
v_b=sortrows(v_b);
np=bit_mask(v_b,n,dt,nb,M,qv);
s=maxi;
% toc


%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

function [v, maxi, dt, n]=data_prep(v,nb)

dt=min(size(v));
dv=size(v);
n=max(dv);

if dv(1)>dv(2),
    v=v';
end
m=min(v');

for i=1:dt,
    v(i,:)=v(i,:)-m(i);
end

maxi=max(max(v));
v=v/maxi;
v=v*(2^nb-1);

if nb<=16,
    v=uint16(v);
elseif nb>16 && nb<=32,
    v=uint32(v);
elseif nb>32 && nb<=64,
    v=uint64(v);
end

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

function [v_b]=bit_int(v,dt,nb,n)

v_b=zeros(dt,n*nb,'uint8');

for i=1:nb,
    v_b(:,n*(i-1)+1:i*n)=bitget(v,nb+1-i);
end

clear v

for j=1:dt-1,
    v_b(j,:)=v_b(j,:)*(2)^(dt-j);
end

if dt~=1
    v_b=uint8(sum(v_b));
elseif dt==1
    v_b=uint8(v_b);
end

v_b=reshape(v_b,n,nb);


%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

function np=bit_mask(v_b,n,dt,nb,M,qv)

v_b(end+1,1:end)=2^dt;
v_b=diff(v_b);
v_b=logical(v_b);
v_b=cumsum((v_b),2);
v_b=logical(v_b);

if M==1
    np=(sum(v_b));
elseif M==2
    np=part_func(v_b,n,dt,nb,qv);
end

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

function np=part_func(v_b,n,dt,nb,qv)

[ic, jc]=find(v_b);
clear v_b
m=uint32(find(diff(jc)));
clear jc
m=[1;m;length(ic)];


l=zeros(n,1,'single');
nc=zeros(n,1,'single');
q=zeros(n,1,'single');
np=zeros(nb,length(qv),'single');

for i=nb:-1:1;
    l=ic(m(i)+1:m(i+1));
    l=(l-[0;l(1:end-1)])/n;
    nc=repmat(l,1,length(qv));
    q=repmat(qv,length(l),1);
    np(nb-i+1,:)=sum((nc).^q);

end



